import { z } from "zod";
import { toThreadedConversationId } from "@microsoft/teams.apps";
import type { BotChannelCreate } from "@linksense/shared";
import type { ChannelInbound } from "../types.js";

const id = z.string().min(1).max(1024);
const text = z.string().trim().min(1).max(100_000);
const wecomMessage = z.object({
  msgid: z.string().min(1).max(240),
  aibotid: id,
  chattype: z.enum(["single", "group"]),
  chatid: id.optional(),
  from: z.object({ userid: z.string().min(1).max(256) }),
  msgtype: z.literal("text"),
  text: z.object({ content: text }),
  create_time: z.number().finite().optional(),
});
const dingMessage = z.object({
  msgId: z.string().min(1).max(240),
  robotCode: id,
  conversationId: id,
  conversationType: z.enum(["1", "2"]),
  senderStaffId: z.string().min(1).max(256),
  isInAtList: z.boolean().optional(),
  msgtype: z.literal("text"),
  text: z.object({ content: text }),
  createAt: z.number().finite(),
});
const teamsMessage = z.object({
  type: z.literal("message"),
  id: z.string().min(1).max(240),
  channelId: z.literal("msteams"),
  text,
  serviceUrl: z.url().max(2048),
  timestamp: z.string().optional(),
  from: z.object({ aadObjectId: z.uuid(), role: z.string().optional() }),
  recipient: z.object({ id }),
  conversation: z.object({
    id,
    conversationType: z.enum(["personal", "groupChat", "channel"]),
    tenantId: z.uuid().optional(),
  }),
  channelData: z.object({ tenant: z.object({ id: z.uuid() }) }),
  replyToId: z.string().max(240).optional(),
  entities: z
    .array(
      z.object({ type: z.string(), mentioned: z.object({ id }).optional() }),
    )
    .optional(),
});

export function validTeamsServiceUrl(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return (
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    (!url.port || url.port === "443") &&
    (url.hostname === "smba.trafficmanager.net" ||
      url.hostname.endsWith(".smba.trafficmanager.net") ||
      url.hostname === "smba.infra.teams.microsoft.com" ||
      url.hostname.endsWith(".smba.infra.teams.microsoft.com"))
  );
}

export function projectChannelMessage(
  credentials: BotChannelCreate,
  payload: unknown,
  now = new Date(),
): ChannelInbound | null {
  if (credentials.provider === "wecom") {
    const parsed = wecomMessage.safeParse(payload);
    if (!parsed.success) return null;
    const m = parsed.data;
    const group = m.chattype === "group";
    if (
      m.aibotid !== credentials.bot_id ||
      m.from.userid !== credentials.allowed_sender_id ||
      (group && (!credentials.allow_group_messages || !m.chatid))
    )
      return null;
    const chatId = group ? m.chatid : m.from.userid;
    if (!chatId) return null;
    return {
      messageKey: m.msgid,
      chatId,
      senderId: m.from.userid,
      text: m.text.content,
      group,
      receivedAt: now,
      context: { provider: "wecom", chatId },
    };
  }
  if (credentials.provider === "dingtalk") {
    const parsed = dingMessage.safeParse(payload);
    if (!parsed.success) return null;
    const m = parsed.data;
    const group = m.conversationType === "2";
    if (
      m.robotCode !== credentials.client_id ||
      m.senderStaffId !== credentials.allowed_sender_id ||
      (group && (!credentials.allow_group_messages || m.isInAtList !== true))
    )
      return null;
    return {
      messageKey: m.msgId,
      chatId: m.conversationId,
      senderId: m.senderStaffId,
      text: m.text.content,
      group,
      receivedAt: now,
      context: {
        provider: "dingtalk",
        chatId: m.conversationId,
        senderId: m.senderStaffId,
        group,
      },
    };
  }
  const parsed = teamsMessage.safeParse(payload);
  if (!parsed.success) return null;
  const m = parsed.data;
  const group = m.conversation.conversationType !== "personal";
  const isBotMentioned =
    m.entities?.some(
      (entity) =>
        entity.type === "mention" && entity.mentioned?.id === m.recipient.id,
    ) === true;
  if (
    m.from.role === "bot" ||
    m.from.aadObjectId.toLowerCase() !==
      credentials.allowed_sender_id.toLowerCase() ||
    m.channelData.tenant.id.toLowerCase() !==
      credentials.tenant_id.toLowerCase() ||
    !validTeamsServiceUrl(m.serviceUrl) ||
    (group && (!credentials.allow_group_messages || !isBotMentioned))
  )
    return null;
  const content = m.text.replace(/<at\b[^>]*>[\s\S]*?<\/at>/giu, "").trim();
  if (!content) return null;
  const threadId =
    m.conversation.conversationType === "channel"
      ? (m.replyToId ?? m.id)
      : null;
  let chatId: string;
  try {
    chatId = threadId
      ? toThreadedConversationId(m.conversation.id, threadId)
      : m.conversation.id;
  } catch {
    return null;
  }
  if (chatId.length > 1024) return null;
  return {
    messageKey: m.id,
    chatId,
    senderId: m.from.aadObjectId.toLowerCase(),
    text: content,
    group,
    receivedAt: now,
    context: { provider: "teams", chatId, serviceUrl: m.serviceUrl, threadId },
  };
}
