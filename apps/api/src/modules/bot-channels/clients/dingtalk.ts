import { DWClient, TOPIC_ROBOT } from "dingtalk-stream";
import { z } from "zod";
import { projectChannelMessage } from "./message-projection.js";
import {
  ChannelProtocolError,
  type ChannelConnectInput,
  type ChannelSession,
} from "../types.js";

export async function connectDingtalk(
  input: ChannelConnectInput,
  request: typeof fetch = fetch,
): Promise<ChannelSession> {
  const credentials = input.credentials;
  if (credentials.provider !== "dingtalk")
    throw new ChannelProtocolError("BOT_CHANNEL_PROTOCOL_INVALID");
  const client = new DWClient({
    clientId: credentials.client_id,
    clientSecret: credentials.client_secret,
    keepAlive: true,
    debug: false,
    autoReconnect: false,
    maxPendingCallbackHandlers: 20,
  });
  client.registerCallbackListener(TOPIC_ROBOT, async (frame) => {
    try {
      let payload: unknown;
      try {
        payload = JSON.parse(frame.data);
      } catch {
        client.socketCallBackResponse(frame.headers.messageId, {});
        return;
      }
      const message = projectChannelMessage(credentials, payload);
      if (message) await input.onMessage(message);
      // Acknowledge only after the durable inbox has accepted the message.
      client.socketCallBackResponse(frame.headers.messageId, {});
    } catch {
      input.onError(new ChannelProtocolError("BOT_CHANNEL_CONNECTION_FAILED"));
    }
  });
  const abort = () => client.disconnect();
  input.signal.addEventListener("abort", abort, { once: true });
  // The SDK bounds HTTP discovery, but not the subsequent WebSocket handshake.
  const connectTimeout = setTimeout(abort, 20_000);
  try {
    input.signal.throwIfAborted();
    await client.connect();
    input.signal.throwIfAborted();
    if (!client.connected)
      throw new ChannelProtocolError("BOT_CHANNEL_CONNECTION_FAILED");
  } catch {
    input.signal.removeEventListener("abort", abort);
    client.disconnect();
    throw new ChannelProtocolError("BOT_CHANNEL_CONNECTION_FAILED");
  } finally {
    clearTimeout(connectTimeout);
  }
  let token: { value: string; expiresAt: number } | null = null;
  const post = async (
    url: string,
    body: unknown,
    accessToken?: string,
  ): Promise<unknown> => {
    const response = await request(url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.any([input.signal, AbortSignal.timeout(15_000)]),
      headers: {
        "content-type": "application/json",
        ...(accessToken ? { "x-acs-dingtalk-access-token": accessToken } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!response.ok)
      throw new ChannelProtocolError("BOT_CHANNEL_DELIVERY_FAILED");
    return response.json();
  };
  return {
    isConnected: () => client.connected,
    close: async () => {
      input.signal.removeEventListener("abort", abort);
      client.disconnect();
    },
    send: async (context, text) => {
      if (context.provider !== "dingtalk")
        throw new ChannelProtocolError("BOT_CHANNEL_PROTOCOL_INVALID");
      if (!token || token.expiresAt <= Date.now()) {
        const result = z
          .object({
            accessToken: z.string().min(1),
            expireIn: z.number().positive(),
          })
          .parse(
            await post("https://api.dingtalk.com/v1.0/oauth2/accessToken", {
              appKey: credentials.client_id,
              appSecret: credentials.client_secret,
            }),
          );
        token = {
          value: result.accessToken,
          expiresAt: Date.now() + Math.max(0, result.expireIn - 60) * 1000,
        };
      }
      try {
        const result = await post(
          `https://api.dingtalk.com/v1.0/robot/${context.group ? "groupMessages/send" : "oToMessages/batchSend"}`,
          {
            robotCode: credentials.client_id,
            msgKey: "sampleText",
            msgParam: JSON.stringify({ content: text }),
            ...(context.group
              ? { openConversationId: context.chatId }
              : { userIds: [context.senderId] }),
          },
          token.value,
        );
        z.object({
          processQueryKey: z.string().min(1),
          invalidStaffIdList: z.array(z.string()).optional(),
          flowControlledStaffIdList: z.array(z.string()).optional(),
        })
          .refine(
            (value) =>
              !value.invalidStaffIdList?.length &&
              !value.flowControlledStaffIdList?.length,
          )
          .parse(result);
      } catch {
        token = null;
        throw new ChannelProtocolError("BOT_CHANNEL_DELIVERY_FAILED");
      }
    },
  };
}
