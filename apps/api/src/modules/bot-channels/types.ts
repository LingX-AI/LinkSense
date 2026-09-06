import { z } from "zod";
import type { BotChannelCreate } from "@linksense/shared";

const chatId = z.string().min(1).max(1024);
export const replyContextSchema = z.discriminatedUnion("provider", [
  z.strictObject({ provider: z.literal("wecom"), chatId }),
  z.strictObject({
    provider: z.literal("dingtalk"),
    chatId,
    senderId: z.string().min(1).max(256),
    group: z.boolean(),
  }),
  z.strictObject({
    provider: z.literal("teams"),
    chatId,
    serviceUrl: z.url().max(2048),
    threadId: z.string().max(240).nullable(),
  }),
]);
export type ReplyContext = z.infer<typeof replyContextSchema>;
export type ChannelInbound = {
  messageKey: string;
  chatId: string;
  senderId: string;
  text: string;
  group: boolean;
  receivedAt: Date;
  context: ReplyContext;
};
export type ChannelHttpRequest = {
  body: unknown;
  headers: Record<string, string | string[]>;
};
export type ChannelHttpResponse = { status: number; body?: unknown };
export type ChannelSession = {
  isConnected(): boolean;
  close(): Promise<void>;
  send(context: ReplyContext, text: string): Promise<void>;
  handleRequest?: (request: ChannelHttpRequest) => Promise<ChannelHttpResponse>;
};
export type ChannelConnectInput = {
  id: string;
  credentials: BotChannelCreate;
  signal: AbortSignal;
  onMessage(message: ChannelInbound): Promise<void>;
  onError(error: unknown): void;
};
export interface BotChannelClient {
  connect(input: ChannelConnectInput): Promise<ChannelSession>;
}

export class ChannelProtocolError extends Error {
  constructor(
    readonly code:
      | "BOT_CHANNEL_CONNECTION_FAILED"
      | "BOT_CHANNEL_DELIVERY_FAILED"
      | "BOT_CHANNEL_PROTOCOL_INVALID",
  ) {
    super(code);
  }
}
