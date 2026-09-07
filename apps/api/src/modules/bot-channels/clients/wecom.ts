import { WSClient } from "@wecom/aibot-node-sdk";
import { projectChannelMessage } from "./message-projection.js";
import {
  ChannelProtocolError,
  type ChannelConnectInput,
  type ChannelSession,
} from "../types.js";

export async function connectWecom(
  input: ChannelConnectInput,
): Promise<ChannelSession> {
  if (input.credentials.provider !== "wecom")
    throw new ChannelProtocolError("BOT_CHANNEL_PROTOCOL_INVALID");
  const client = new WSClient({
    botId: input.credentials.bot_id,
    secret: input.credentials.secret,
    maxReconnectAttempts: 5,
    maxAuthFailureAttempts: 1,
    requestTimeout: 15_000,
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
  });
  let authenticated = false;
  client.on("authenticated", () => {
    authenticated = true;
  });
  client.on("disconnected", () => {
    authenticated = false;
  });
  client.on("error", () =>
    input.onError(new ChannelProtocolError("BOT_CHANNEL_CONNECTION_FAILED")),
  );
  client.on("message.text", (frame) => {
    const message = projectChannelMessage(input.credentials, frame.body);
    if (message) void input.onMessage(message).catch(input.onError);
  });
  const abort = () => client.disconnect();
  input.signal.addEventListener("abort", abort, { once: true });
  try {
    await new Promise<void>((resolve, reject) => {
      const fail = () => {
        cleanup();
        reject(new ChannelProtocolError("BOT_CHANNEL_CONNECTION_FAILED"));
      };
      const success = () => {
        cleanup();
        resolve();
      };
      const timer = setTimeout(fail, 20_000);
      const cleanup = () => {
        clearTimeout(timer);
        client.off("authenticated", success);
        client.off("error", fail);
        input.signal.removeEventListener("abort", fail);
      };
      client.on("authenticated", success);
      client.on("error", fail);
      input.signal.addEventListener("abort", fail, { once: true });
      if (input.signal.aborted) fail();
      else client.connect();
    });
  } catch (error) {
    input.signal.removeEventListener("abort", abort);
    client.disconnect();
    throw error;
  }
  return {
    isConnected: () => authenticated && client.isConnected,
    close: async () => {
      input.signal.removeEventListener("abort", abort);
      client.disconnect();
    },
    send: async (context, text) => {
      if (context.provider !== "wecom" || !authenticated || !client.isConnected)
        throw new ChannelProtocolError("BOT_CHANNEL_DELIVERY_FAILED");
      await client.sendMessage(context.chatId, {
        msgtype: "markdown",
        markdown: { content: text },
      });
    },
  };
}
