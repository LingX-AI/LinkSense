import { createHash, randomBytes } from "node:crypto";

import { z } from "zod";

const WEIXIN_LOGIN_BASE_URL = "https://ilinkai.weixin.qq.com";
const WEIXIN_CHANNEL_VERSION = "2.4.6";
const WEIXIN_CLIENT_VERSION = 0x0002_0406;
const DEFAULT_API_TIMEOUT_MS = 15_000;
const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
const MAX_INBOUND_TEXT_LENGTH = 1_000_000;
const MAX_JSON_RESPONSE_BYTES = 32 * 1_024 * 1_024;

const nullableString = (maximumLength: number) =>
  z.string().max(maximumLength).nullish();
const nullableInteger = z.number().int().nullish();
const nullableNonNegativeInteger = z.number().int().nonnegative().nullish();
const jsonNumber = z.number().finite();

const loginStatusSchema = z.enum([
  "wait",
  "scaned",
  "confirmed",
  "expired",
  "scaned_but_redirect",
  "need_verifycode",
  "verify_code_blocked",
  "binded_redirect",
]);

const qrCodeResponseSchema = z
  .object({
    qrcode: z.string().min(1).max(16_384),
    qrcode_img_content: z.string().url().max(4_096),
  })
  .passthrough();

const loginStatusResponseSchema = z
  .object({
    status: loginStatusSchema,
    bot_token: z.string().min(1).max(16_384).optional(),
    ilink_bot_id: z.string().min(1).max(4_096).optional(),
    ilink_user_id: z.string().min(1).max(4_096).optional(),
    baseurl: z.string().url().max(4_096).optional(),
    redirect_host: z.string().min(1).max(1_024).optional(),
  })
  .passthrough();

const messageItemSchema = z
  .object({
    type: nullableInteger,
    create_time_ms: nullableNonNegativeInteger,
    update_time_ms: nullableNonNegativeInteger,
    is_completed: z.boolean().nullish(),
    msg_id: nullableString(4_096),
    ref_msg: z.unknown().nullish(),
    text_item: z
      .object({ text: nullableString(1_000_000) })
      .passthrough()
      .nullish(),
    voice_item: z
      .object({ text: nullableString(1_000_000) })
      .passthrough()
      .nullish(),
    image_item: z.unknown().nullish(),
    file_item: z.unknown().nullish(),
    video_item: z.unknown().nullish(),
    tool_call_start_item: z.unknown().nullish(),
    tool_call_result_item: z.unknown().nullish(),
  })
  .passthrough();

const messageSchema = z
  .object({
    seq: nullableNonNegativeInteger,
    message_id: z.union([jsonNumber, z.string().max(240)]).nullish(),
    from_user_id: nullableString(4_096),
    to_user_id: nullableString(4_096),
    client_id: nullableString(4_096),
    create_time_ms: nullableNonNegativeInteger,
    update_time_ms: nullableNonNegativeInteger,
    delete_time_ms: nullableNonNegativeInteger,
    session_id: nullableString(4_096),
    group_id: nullableString(4_096),
    message_type: nullableInteger,
    message_state: nullableInteger,
    item_list: z.array(messageItemSchema).max(128).nullish(),
    context_token: nullableString(64 * 1_024),
    run_id: nullableString(4_096),
  })
  .passthrough();

const updatesResponseSchema = z
  .object({
    ret: nullableInteger,
    errcode: nullableInteger,
    errmsg: nullableString(4_096),
    msgs: z.array(messageSchema).max(1_000).nullish(),
    sync_buf: nullableString(8 * 1_024 * 1_024),
    get_updates_buf: nullableString(8 * 1_024 * 1_024),
    longpolling_timeout_ms: nullableNonNegativeInteger,
  })
  .passthrough();

const sendResponseSchema = z
  .object({
    ret: nullableInteger,
    errcode: nullableInteger,
    errmsg: nullableString(4_096),
  })
  .passthrough();

const configResponseSchema = z
  .object({
    ret: nullableInteger,
    errcode: nullableInteger,
    errmsg: nullableString(4_096),
    typing_ticket: nullableString(16_384),
  })
  .passthrough();

type FetchLike = typeof fetch;
type WeixinMessage = z.infer<typeof messageSchema>;

export type WeixinLoginPollResult = z.infer<
  typeof loginStatusResponseSchema
>;

export type WeixinUpdatesResult = {
  cursor: string;
  messages: WeixinMessage[];
  suggestedTimeoutMs: number | null;
};

export type WeixinConfigResult = {
  typingTicket: string;
};

export type WeixinTypingStatus = "typing" | "cancel";

export type WeixinInboundText = {
  messageKey: string;
  peerUserId: string;
  contextToken: string;
  text: string;
  receivedAt: Date;
  sourceSequence: bigint | null;
};

export class WeixinProtocolError extends Error {
  constructor(
    readonly reasonCode:
      | "WEIXIN_UPSTREAM_UNAVAILABLE"
      | "WEIXIN_UPSTREAM_REJECTED"
      | "WEIXIN_CREDENTIAL_EXPIRED"
      | "WEIXIN_PROTOCOL_INVALID",
    options?: { cause?: unknown },
  ) {
    super(reasonCode, options);
    this.name = "WeixinProtocolError";
  }
}

export class WeixinIlinkClient {
  constructor(private readonly fetchImpl: FetchLike = fetch) {}

  async startLogin(localTokenList: readonly string[]): Promise<{
    qrcode: string;
    qrcodeUrl: string;
  }> {
    const response = await this.#requestJson({
      baseUrl: WEIXIN_LOGIN_BASE_URL,
      endpoint: "ilink/bot/get_bot_qrcode?bot_type=3",
      method: "POST",
      body: {
        local_token_list: localTokenList
          .map((token) => token.trim())
          .filter(Boolean)
          .slice(-10),
      },
      schema: qrCodeResponseSchema,
      timeoutMs: DEFAULT_API_TIMEOUT_MS,
    });
    return {
      qrcode: response.qrcode,
      qrcodeUrl: response.qrcode_img_content,
    };
  }

  async pollLogin(input: {
    qrcode: string;
    baseUrl?: string;
    verifyCode?: string;
    signal?: AbortSignal;
  }): Promise<WeixinLoginPollResult> {
    const query = new URLSearchParams({ qrcode: input.qrcode });
    if (input.verifyCode) query.set("verify_code", input.verifyCode);
    try {
      return await this.#requestJson({
        baseUrl: input.baseUrl ?? WEIXIN_LOGIN_BASE_URL,
        endpoint: `ilink/bot/get_qrcode_status?${query.toString()}`,
        method: "GET",
        schema: loginStatusResponseSchema,
        timeoutMs: DEFAULT_LONG_POLL_TIMEOUT_MS,
        ...(input.signal ? { signal: input.signal } : {}),
      });
    } catch (error) {
      if (isAbortError(error) && !input.signal?.aborted) {
        return { status: "wait" };
      }
      throw error;
    }
  }

  async getUpdates(input: {
    baseUrl: string;
    token: string;
    cursor: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<WeixinUpdatesResult> {
    try {
      const response = await this.#requestJson({
        baseUrl: input.baseUrl,
        endpoint: "ilink/bot/getupdates",
        method: "POST",
        token: input.token,
        body: {
          get_updates_buf: input.cursor,
          base_info: baseInfo(),
        },
        schema: updatesResponseSchema,
        timeoutMs: input.timeoutMs ?? DEFAULT_LONG_POLL_TIMEOUT_MS,
        ...(input.signal ? { signal: input.signal } : {}),
      });
      assertSuccessfulResponse(response);
      return {
        cursor: response.get_updates_buf ?? input.cursor,
        messages: response.msgs ?? [],
        suggestedTimeoutMs: response.longpolling_timeout_ms ?? null,
      };
    } catch (error) {
      if (isAbortError(error)) {
        return {
          cursor: input.cursor,
          messages: [],
          suggestedTimeoutMs: null,
        };
      }
      throw error;
    }
  }

  async sendText(input: {
    baseUrl: string;
    token: string;
    toUserId: string;
    contextToken: string;
    text: string;
    clientId: string;
    signal?: AbortSignal;
  }): Promise<void> {
    const response = await this.#requestJson({
      baseUrl: input.baseUrl,
      endpoint: "ilink/bot/sendmessage",
      method: "POST",
      token: input.token,
      body: {
        msg: {
          from_user_id: "",
          to_user_id: input.toUserId,
          client_id: input.clientId,
          message_type: 2,
          message_state: 2,
          item_list: [{ type: 1, text_item: { text: input.text } }],
          context_token: input.contextToken,
        },
        base_info: baseInfo(),
      },
      schema: sendResponseSchema,
      timeoutMs: DEFAULT_API_TIMEOUT_MS,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    assertSuccessfulResponse(response);
  }

  async getConfig(input: {
    baseUrl: string;
    token: string;
    ilinkUserId: string;
    contextToken?: string;
    signal?: AbortSignal;
  }): Promise<WeixinConfigResult> {
    const response = await this.#requestJson({
      baseUrl: input.baseUrl,
      endpoint: "ilink/bot/getconfig",
      method: "POST",
      token: input.token,
      body: {
        ilink_user_id: input.ilinkUserId,
        ...(input.contextToken ? { context_token: input.contextToken } : {}),
        base_info: baseInfo(),
      },
      schema: configResponseSchema,
      timeoutMs: DEFAULT_API_TIMEOUT_MS,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    assertSuccessfulResponse(response);
    return { typingTicket: response.typing_ticket?.trim() ?? "" };
  }

  async sendTyping(input: {
    baseUrl: string;
    token: string;
    ilinkUserId: string;
    typingTicket: string;
    status: WeixinTypingStatus;
    signal?: AbortSignal;
  }): Promise<void> {
    const response = await this.#requestJson({
      baseUrl: input.baseUrl,
      endpoint: "ilink/bot/sendtyping",
      method: "POST",
      token: input.token,
      body: {
        ilink_user_id: input.ilinkUserId,
        typing_ticket: input.typingTicket,
        status: input.status === "typing" ? 1 : 2,
        base_info: baseInfo(),
      },
      schema: sendResponseSchema,
      timeoutMs: DEFAULT_API_TIMEOUT_MS,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    assertSuccessfulResponse(response);
  }

  async notifyStart(input: {
    baseUrl: string;
    token: string;
    signal?: AbortSignal;
  }): Promise<void> {
    const response = await this.#requestJson({
      baseUrl: input.baseUrl,
      endpoint: "ilink/bot/msg/notifystart",
      method: "POST",
      token: input.token,
      body: { base_info: baseInfo() },
      schema: sendResponseSchema,
      timeoutMs: DEFAULT_API_TIMEOUT_MS,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    assertSuccessfulResponse(response);
  }

  async notifyStop(input: {
    baseUrl: string;
    token: string;
    signal?: AbortSignal;
  }): Promise<void> {
    const response = await this.#requestJson({
      baseUrl: input.baseUrl,
      endpoint: "ilink/bot/msg/notifystop",
      method: "POST",
      token: input.token,
      body: { base_info: baseInfo() },
      schema: sendResponseSchema,
      timeoutMs: DEFAULT_API_TIMEOUT_MS,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    assertSuccessfulResponse(response);
  }

  async #requestJson<TSchema extends z.ZodTypeAny>(input: {
    baseUrl: string;
    endpoint: string;
    method: "GET" | "POST";
    token?: string;
    body?: unknown;
    schema: TSchema;
    timeoutMs: number;
    signal?: AbortSignal;
  }): Promise<z.infer<TSchema>> {
    const baseUrl = normalizeWeixinApiBaseUrl(input.baseUrl);
    const url = new URL(input.endpoint, `${baseUrl}/`);
    const abort = createAbortSignal(input.signal, input.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: input.method,
        redirect: "manual",
        headers:
          input.method === "GET"
            ? commonHeaders()
            : authenticatedHeaders(input.token),
        ...(input.body === undefined
          ? {}
          : { body: JSON.stringify(input.body) }),
        ...(abort.signal ? { signal: abort.signal } : {}),
      });
      if (!response.ok) {
        throw new WeixinProtocolError("WEIXIN_UPSTREAM_UNAVAILABLE");
      }
      const raw = await readBoundedJson(response);
      const parsed = input.schema.safeParse(raw);
      if (!parsed.success) {
        throw new WeixinProtocolError("WEIXIN_PROTOCOL_INVALID", {
          cause: parsed.error,
        });
      }
      return parsed.data;
    } catch (error) {
      if (isAbortError(error) || error instanceof WeixinProtocolError) {
        throw error;
      }
      throw new WeixinProtocolError("WEIXIN_UPSTREAM_UNAVAILABLE", {
        cause: error,
      });
    } finally {
      abort.cleanup();
    }
  }
}

export function normalizeWeixinApiBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new WeixinProtocolError("WEIXIN_PROTOCOL_INVALID", { cause: error });
  }
  const hostname = url.hostname.toLowerCase();
  const hostLabels = hostname.split(".");
  const allowedHostname =
    hostname === "weixin.qq.com" ||
    (hostLabels.length === 4 &&
      hostLabels.slice(1).join(".") === "weixin.qq.com");
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    (url.pathname !== "" && url.pathname !== "/") ||
    !allowedHostname
  ) {
    throw new WeixinProtocolError("WEIXIN_PROTOCOL_INVALID");
  }
  return `https://${url.host}`;
}

export function redirectHostToBaseUrl(host: string): string {
  if (host.includes("://") || host.includes("/") || host.includes("@")) {
    throw new WeixinProtocolError("WEIXIN_PROTOCOL_INVALID");
  }
  return normalizeWeixinApiBaseUrl(`https://${host}`);
}

export function extractWeixinInboundText(
  message: WeixinMessage,
  now = new Date(),
): WeixinInboundText | null {
  if (message.message_type === 2 || message.group_id?.trim()) return null;
  const peerUserId = message.from_user_id?.trim();
  const contextToken = message.context_token?.trim();
  if (!peerUserId || !contextToken) return null;

  const parts = (message.item_list ?? []).flatMap((item) => {
    if (item.type === 1 && item.text_item?.text?.trim()) {
      return [item.text_item.text.trim()];
    }
    if (item.type === 3 && item.voice_item?.text?.trim()) {
      return [item.voice_item.text.trim()];
    }
    return [];
  });
  const text = parts.join("\n").trim();
  if (!text || text.length > MAX_INBOUND_TEXT_LENGTH) return null;

  return {
    messageKey: deriveMessageKey(message),
    peerUserId,
    contextToken,
    text,
    receivedAt: safeMessageDate(message.create_time_ms, now),
    sourceSequence:
      message.seq === null ||
      message.seq === undefined ||
      !Number.isSafeInteger(message.seq)
        ? null
        : BigInt(message.seq),
  };
}

export function splitWeixinText(text: string, maximumLength = 4_000): string[] {
  if (!Number.isSafeInteger(maximumLength) || maximumLength < 1) {
    throw new TypeError("maximumLength must be a positive integer");
  }
  const characters = Array.from(text);
  if (characters.length === 0) return [];

  const chunks: string[] = [];
  let offset = 0;
  while (offset < characters.length) {
    const upperBound = Math.min(offset + maximumLength, characters.length);
    let end = upperBound;
    if (upperBound < characters.length) {
      const candidate = characters.slice(offset, upperBound).join("");
      const newlineIndex = candidate.lastIndexOf("\n");
      if (newlineIndex >= Math.floor(maximumLength / 2)) {
        end = offset + Array.from(candidate.slice(0, newlineIndex + 1)).length;
      }
    }
    chunks.push(characters.slice(offset, end).join("").trimEnd());
    offset = end;
    while (characters[offset] === "\n") offset += 1;
  }
  return chunks.filter(Boolean);
}

function assertSuccessfulResponse(response: {
  ret?: number | null | undefined;
  errcode?: number | null | undefined;
}): void {
  const errorCodes = [response.errcode, response.ret].filter(
    (value): value is number => typeof value === "number",
  );
  if (errorCodes.includes(-14)) {
    throw new WeixinProtocolError("WEIXIN_CREDENTIAL_EXPIRED");
  }
  if (errorCodes.some((value) => value !== 0)) {
    throw new WeixinProtocolError("WEIXIN_UPSTREAM_REJECTED");
  }
}

function commonHeaders(): Record<string, string> {
  return {
    "iLink-App-Id": "bot",
    "iLink-App-ClientVersion": String(WEIXIN_CLIENT_VERSION),
  };
}

function authenticatedHeaders(token?: string): Record<string, string> {
  return {
    ...commonHeaders(),
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "X-WECHAT-UIN": randomWechatUin(),
    ...(token?.trim() ? { Authorization: `Bearer ${token.trim()}` } : {}),
  };
}

function baseInfo(): { channel_version: string; bot_agent: string } {
  return {
    channel_version: WEIXIN_CHANNEL_VERSION,
    bot_agent: `LinkSense/${WEIXIN_CHANNEL_VERSION}`,
  };
}

function randomWechatUin(): string {
  const value = randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(value), "utf8").toString("base64");
}

function deriveMessageKey(message: WeixinMessage): string {
  return createHash("sha256")
    .update(
      [
        message.from_user_id ?? "",
        message.message_id ?? "",
        message.client_id?.trim() ?? "",
        message.session_id ?? "",
        message.seq ?? "",
        message.create_time_ms ?? "",
        JSON.stringify(message.item_list ?? []),
      ].join("\0"),
    )
    .digest("hex");
}

function safeMessageDate(
  timestamp: number | null | undefined,
  fallback: Date,
): Date {
  if (!timestamp) return fallback;
  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) return fallback;
  const maximumFuture = fallback.getTime() + 5 * 60_000;
  return value.getTime() <= maximumFuture ? value : fallback;
}

function createAbortSignal(
  external: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; cleanup(): void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  if (external?.aborted) controller.abort();
  else external?.addEventListener("abort", onExternalAbort, { once: true });
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timeout);
      external?.removeEventListener("abort", onExternalAbort);
    },
  };
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentLength = response.headers.get("content-length");
  if (
    contentLength !== null &&
    Number.isFinite(Number(contentLength)) &&
    Number(contentLength) > MAX_JSON_RESPONSE_BYTES
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw new WeixinProtocolError("WEIXIN_PROTOCOL_INVALID");
  }
  if (!response.body) {
    throw new WeixinProtocolError("WEIXIN_PROTOCOL_INVALID");
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_JSON_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new WeixinProtocolError("WEIXIN_PROTOCOL_INVALID");
      }
      chunks.push(Buffer.from(chunk.value));
    }
  } finally {
    reader.releaseLock();
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks, size),
    );
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new WeixinProtocolError("WEIXIN_PROTOCOL_INVALID", { cause: error });
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
